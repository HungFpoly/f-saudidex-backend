import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildClientRuntimeEnvScript } from '../shared/config/clientRuntimeEnv';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).send(buildClientRuntimeEnvScript());
}
