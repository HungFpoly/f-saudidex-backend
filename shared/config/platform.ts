/**
 * Platform detection and configuration
 */

import { getConfiguredBackendUrl } from './runtime';

const isBrowser = typeof window !== 'undefined';

export const PLATFORM = {
  isVercel: isBrowser 
    ? (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('saudidex.ae'))
    : !!process.env.VERCEL,
  isRender: isBrowser
    ? (window.location.hostname.includes('onrender.com') || window.location.hostname.startsWith('admin.'))
    : !!process.env.RENDER,
  isDev: isBrowser
    ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    : process.env.NODE_ENV === 'development'
};

export const getBackendUrl = () => {
  if (PLATFORM.isDev) return ''; // Proxied locally
  if (PLATFORM.isRender) return ''; // Running on the same box

  const configUrl = getConfiguredBackendUrl();
  if (configUrl) return configUrl;

  return 'https://saudidex.onrender.com';
};
