import { Page } from './common';

export { PluginsSection } from './PluginsSection';

export function MarketplaceSection() {
  return (
    <Page title="Marketplace">
      <div className="wz-coming-soon">
        <strong>Coming soon</strong>
        Browse and install plugins and themes from here.
      </div>
    </Page>
  );
}
