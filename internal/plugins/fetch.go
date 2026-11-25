package plugins

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The page can't reach the internet itself (the app's Content-Security-Policy allows only its own
// address), so ctx.net.fetch() comes here. A request goes out only to a site the plugin's
// manifest lists and the user allowed, over https (plain http only to localhost), without
// cookies, and redirects are held to the same list. Names that resolve to a private or local
// address are refused unless the plugin listed localhost itself, so a listed site can't be used
// to poke at the user's router.

const (
	maxFetchBody    = 10 << 20
	defaultTimeout  = 30 * time.Second
	maxTimeout      = 2 * time.Minute
	maxConcurrent   = 6
	maxRedirects    = 5
	maxHeaderValues = 64
)

type FetchRequest struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	// base64, so binary bodies survive the JSON binding
	Body      string `json:"body"`
	TimeoutMs int    `json:"timeoutMs"`
}

type FetchResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	// base64
	Body string `json:"body"`
	// after redirects
	URL string `json:"url"`
}

var allowedMethods = map[string]bool{
	"GET": true, "HEAD": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "OPTIONS": true,
}

// headers a plugin can't set: they'd let it pretend to be someone else or smuggle requests
var blockedHeaders = map[string]bool{
	"host": true, "cookie": true, "cookie2": true, "connection": true, "content-length": true,
	"transfer-encoding": true, "te": true, "trailer": true, "upgrade": true, "keep-alive": true,
	"proxy-authorization": true, "proxy-connection": true, "via": true, "expect": true,
}

// Allowed reports whether u may be fetched with these patterns.
func Allowed(u *url.URL, patterns []string) error {
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	switch u.Scheme {
	case "https":
	case "http":
		if !isLocalHost(host) {
			return errors.New("only https, except for localhost")
		}
	default:
		return fmt.Errorf("%s: links aren't allowed, only https", u.Scheme)
	}
	if u.User != nil {
		return errors.New("user names in the address aren't allowed")
	}
	for _, p := range patterns {
		ph, pp := p, ""
		if h, pt, err := net.SplitHostPort(p); err == nil {
			ph, pp = h, pt
		}
		if pp != "" && pp != port {
			continue
		}
		if ph == host {
			return nil
		}
		if rest, ok := strings.CutPrefix(ph, "*."); ok && strings.HasSuffix(host, "."+rest) {
			return nil
		}
	}
	return fmt.Errorf("%s isn't in the plugin's network list", u.Host)
}

type Fetcher struct {
	UserAgent string
	mu        sync.Mutex
	running   map[string]int
	// tests point this at a local server
	allowPrivate bool
}

func NewFetcher(userAgent string) *Fetcher {
	return &Fetcher{UserAgent: userAgent, running: map[string]int{}}
}

func (f *Fetcher) Do(ctx context.Context, plugin string, patterns []string, req FetchRequest) (FetchResponse, error) {
	var out FetchResponse
	u, err := url.Parse(req.URL)
	if err != nil {
		return out, errors.New("bad address")
	}
	if err := Allowed(u, patterns); err != nil {
		return out, err
	}
	method := strings.ToUpper(req.Method)
	if method == "" {
		method = "GET"
	}
	if !allowedMethods[method] {
		return out, fmt.Errorf("method %s isn't allowed", method)
	}
	body, err := base64.StdEncoding.DecodeString(req.Body)
	if err != nil {
		return out, errors.New("bad body")
	}
	if len(body) > maxFetchBody {
		return out, errors.New("the request body can be at most 10 MB")
	}

	f.mu.Lock()
	if f.running[plugin] >= maxConcurrent {
		f.mu.Unlock()
		return out, errors.New("too many requests at once")
	}
	f.running[plugin]++
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.running[plugin]--
		f.mu.Unlock()
	}()

	timeout := defaultTimeout
	if req.TimeoutMs > 0 {
		timeout = min(time.Duration(req.TimeoutMs)*time.Millisecond, maxTimeout)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	r, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	n := 0
	for k, v := range req.Headers {
		lk := strings.ToLower(k)
		if blockedHeaders[lk] || strings.HasPrefix(lk, "sec-") || strings.HasPrefix(lk, "proxy-") {
			continue
		}
		if n++; n > maxHeaderValues {
			break
		}
		r.Header.Set(k, v)
	}
	r.Header.Set("User-Agent", f.UserAgent+" plugin/"+plugin)

	local := isLocalHost(strings.ToLower(u.Hostname()))
	client := &http.Client{
		Transport: f.transport(local),
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("too many redirects")
			}
			return Allowed(next.URL, patterns)
		},
	}
	res, err := client.Do(r)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return out, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxFetchBody+1))
	if err != nil {
		return out, err
	}
	if len(data) > maxFetchBody {
		return out, errors.New("the answer is bigger than 10 MB")
	}
	out.Status = res.StatusCode
	out.StatusText = strings.TrimSpace(strings.TrimPrefix(res.Status, fmt.Sprint(res.StatusCode)))
	out.Headers = map[string]string{}
	for k, v := range res.Header {
		if strings.EqualFold(k, "Set-Cookie") {
			continue
		}
		out.Headers[strings.ToLower(k)] = strings.Join(v, ", ")
	}
	out.Body = base64.StdEncoding.EncodeToString(data)
	out.URL = res.Request.URL.String()
	return out, nil
}

func (f *Fetcher) transport(allowLocal bool) *http.Transport {
	d := &net.Dialer{Timeout: 15 * time.Second}
	if !allowLocal && !f.allowPrivate {
		d.Control = func(_, address string, _ syscall.RawConn) error {
			host, _, _ := net.SplitHostPort(address)
			if ip := net.ParseIP(host); ip != nil && isPrivate(ip) {
				return fmt.Errorf("%s is a local address", ip)
			}
			return nil
		}
	}
	return &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           d.DialContext,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: maxTimeout,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
	}
}

func isPrivate(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || ip.Equal(net.IPv4bcast) ||
		// carrier-grade NAT and the 0.0.0.0/8 block
		(ip.To4() != nil && (ip.To4()[0] == 100 && ip.To4()[1]&0xc0 == 64 || ip.To4()[0] == 0))
}
