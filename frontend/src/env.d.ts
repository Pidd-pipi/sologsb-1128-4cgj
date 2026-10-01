/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 高德地图 JS API Key；留空时地图页走本地 SVG 网格降级视图 */
  readonly VITE_AMAP_KEY?: string;
}

interface Window {
  AMap?: any;
  _AMapSecurityConfig?: Record<string, string>;
  __AMAP_LOADED__?: boolean;
}
