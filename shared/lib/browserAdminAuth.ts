import { supabase } from './supabase';

export async function getBrowserAdminAccessToken(): Promise<string | null> {
  if (!supabase) return null;

  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token?.trim();
    return accessToken ? `Bearer ${accessToken}` : null;
  } catch (err) {
    console.error('Failed to fetch Supabase session for admin API auth:', err);
    return null;
  }
}

export async function buildAdminApiHeaders(
  baseHeaders: Record<string, string> = {},
): Promise<Record<string, string>> {
  const token = await getBrowserAdminAccessToken();
  if (!token) return { ...baseHeaders };

  return {
    ...baseHeaders,
    Authorization: token,
  };
}
