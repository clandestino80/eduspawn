export type KlingHttpOk = {
  ok: true;
  status: number;
  json: unknown;
};

export type KlingHttpErr = {
  ok: false;
  status: number;
  message: string;
  errorCode: string;
  json?: unknown;
  rawBody?: string;
};

export type KlingHttpResult = KlingHttpOk | KlingHttpErr;
