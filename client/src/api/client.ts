async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
      if (body.details) message += `: ${body.details.join(', ')}`;
    } catch { /* JSON 아님 */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => fetch(`/api${url}`).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  put: <T>(url: string, body: unknown) =>
    fetch(`/api${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  patch: <T>(url: string, body: unknown) =>
    fetch(`/api${url}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  del: <T>(url: string) =>
    fetch(`/api${url}`, { method: 'DELETE' }).then((r) => handle<T>(r)),
  upload: <T>(url: string, formData: FormData) =>
    fetch(`/api${url}`, { method: 'POST', body: formData }).then((r) => handle<T>(r)),
};
