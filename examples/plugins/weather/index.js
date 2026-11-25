// Weather: an example of a sandboxed plugin. It runs in a worker with no DOM and no network of its own;
// ctx.net.fetch goes through WhatsZori to the two open-meteo hosts in the manifest, nowhere else.
// Its UI is plain data ({ t: 'text', ... }) that WhatsZori draws.

const CODES = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Rime fog'], 51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Heavy drizzle'], 61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Violent showers'], 85: ['🌨️', 'Snow showers'],
  86: ['🌨️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Thunderstorm, hail'],
};

export default {
  async start(ctx) {
    let state = { loading: true, error: '', place: '', now: null, days: [], units: 'celsius', at: 0 };

    async function load() {
      state = { ...state, loading: true, error: '' };
      ctx.invalidate();
      try {
        const city = String((await ctx.settings.get('city')) || 'Moscow');
        const units = String((await ctx.settings.get('units')) || 'celsius');
        const geo = await (await ctx.net.fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`)).json();
        const p = geo.results?.[0];
        if (!p) throw new Error(`no place called “${city}”`);
        const q = new URLSearchParams({
          latitude: p.latitude, longitude: p.longitude, timezone: 'auto', forecast_days: '4',
          current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min',
          temperature_unit: units, wind_speed_unit: units === 'fahrenheit' ? 'mph' : 'kmh',
        });
        const res = await ctx.net.fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
        if (!res.ok) throw new Error(`open-meteo answered ${res.status}`);
        const w = await res.json();
        state = {
          loading: false, error: '', units, at: Date.now(),
          place: [p.name, p.country].filter(Boolean).join(', '),
          now: w.current,
          days: w.daily.time.map((t, i) => ({ t, code: w.daily.weather_code[i], max: w.daily.temperature_2m_max[i], min: w.daily.temperature_2m_min[i] })),
        };
      } catch (err) {
        state = { ...state, loading: false, error: String(err.message || err) };
      }
      ctx.invalidate();
    }

    const deg = () => (state.units === 'fahrenheit' ? '°F' : '°C');
    const line = () => {
      const [icon, label] = CODES[state.now.weather_code] ?? ['🌡️', ''];
      return `${icon} ${state.place}: ${Math.round(state.now.temperature_2m)}${deg()}, ${label.toLowerCase()}, wind ${Math.round(state.now.wind_speed_10m)} ${state.units === 'fahrenheit' ? 'mph' : 'km/h'}`;
    };

    function view() {
      if (state.loading && !state.now) return { t: 'row', children: [{ t: 'spinner' }, { t: 'text', text: 'Asking open-meteo…', muted: true }] };
      if (state.error) return { t: 'stack', children: [
        { t: 'text', text: `Couldn't get the weather: ${state.error}` },
        { t: 'button', label: 'Try again', onClick: load },
      ] };
      const [icon, label] = CODES[state.now.weather_code] ?? ['🌡️', ''];
      return { t: 'stack', gap: 12, children: [
        { t: 'row', gap: 12, children: [
          { t: 'text', text: icon, size: 'lg' },
          { t: 'stack', gap: 2, children: [
            { t: 'heading', text: `${Math.round(state.now.temperature_2m)}${deg()} · ${label}` },
            { t: 'text', text: state.place, muted: true, size: 'sm' },
          ] },
        ] },
        { t: 'text', size: 'sm', text: `Feels like ${Math.round(state.now.apparent_temperature)}${deg()} · humidity ${state.now.relative_humidity_2m}% · wind ${Math.round(state.now.wind_speed_10m)}` },
        { t: 'divider' },
        { t: 'list', items: state.days.map((d) => ({
          key: d.t,
          title: `${(CODES[d.code] ?? ['🌡️'])[0]} ${new Date(d.t).toLocaleDateString(undefined, { weekday: 'long' })}`,
          right: `${Math.round(d.min)}…${Math.round(d.max)}${deg()}`,
        })) },
        { t: 'row', gap: 8, children: [
          { t: 'button', label: 'Put into the message', variant: 'primary', onClick: () => ctx.composer.insert(line()) },
          { t: 'button', label: state.loading ? 'Updating…' : 'Update', disabled: state.loading, onClick: load },
        ] },
        { t: 'link', text: 'Data: open-meteo.com', href: 'https://api.open-meteo.com/' },
      ] };
    }

    await ctx.panels.register({ id: 'now', title: 'Weather', icon: '🌤️', render: view });
    await ctx.commands.register({
      id: 'insert', title: 'Weather: put it into the message', shortcut: 'Ctrl+Alt+W',
      run: async () => {
        if (!state.now) await load();
        if (state.now) await ctx.composer.insert(line());
      },
    });
    await ctx.settings.onChange(() => load());
    void load();
    ctx.log.info('sandboxed and running');
  },
};
