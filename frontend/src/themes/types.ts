export interface ThemeModuleInfo {
  id: string;
  name: string;
  description?: string;
  file: string;
  // required modules are always on and not shown as toggles
  required?: boolean;
  // initial state for optional modules, true if omitted
  default?: boolean;
}

export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  // layout the theme was designed for; turning the theme on switches to it
  layout?: 'panels' | 'rail';
  modules: ThemeModuleInfo[];
}

export interface ThemePackage {
  manifest: ThemeManifest;
  // file name -> css text
  css: Record<string, string>;
}
