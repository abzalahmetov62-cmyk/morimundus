const fetchBeforeAuth = globalThis.fetch;
globalThis.fetch = (input, options = {}) => {
  const headers = new Headers(options.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('oai-authenticated-user-id', 'stage11-check-author');
  headers.set('oai-authenticated-user-email', 'author@morimundus.test');
  return fetchBeforeAuth(input, { ...options, headers });
};
