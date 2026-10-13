/**
 * Invoice upload with real progress: percentages come from bytes sent, the "processing"
 * stage starts only after the upload finishes, and failures are reported, never hidden.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadWithProgress, ApiError } from '../../api/client';
import { invoiceApi } from '../../api/invoice';

type Listener = ((event: any) => void) | null;

class FakeXhr {
  static last: FakeXhr | null = null;
  static script: (xhr: FakeXhr) => void = () => {};
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 0;
  statusText = '';
  responseText = '';
  responseHeaders: Record<string, string> = {};
  sentBody: unknown = null;
  onload: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;
  upload: { onprogress: Listener; onload: Listener } = { onprogress: null, onload: null };

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: unknown) {
    this.sentBody = body;
    FakeXhr.script(this);
  }
  abort() {
    this.onabort?.({});
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.statusText = status === 200 ? 'OK' : 'Error';
    this.responseHeaders['content-type'] = 'application/json';
    this.responseText = JSON.stringify(body);
    this.onload?.({});
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.last = null;
  FakeXhr.script = () => {};
});

const form = () => {
  const data = new FormData();
  data.append('file', new File(['%PDF-1.4'], 'bill.pdf', { type: 'application/pdf' }));
  return data;
};

describe('uploadWithProgress', () => {
  it('reports real byte progress, then upload completion, then resolves with the JSON body', async () => {
    const events: string[] = [];
    FakeXhr.script = (xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
      xhr.upload.onload?.({});
      xhr.respond(200, { id: 'inv_1', items: [] });
    };
    vi.stubGlobal('XMLHttpRequest', FakeXhr as any);

    const result = await uploadWithProgress<{ id: string }>('/api/v1/invoices/extract', form(), {
      onUploadProgress: (p) => events.push(`progress:${p.percent}`),
      onUploadComplete: () => events.push('uploaded'),
    });

    expect(result.id).toBe('inv_1');
    expect(events).toEqual(['progress:25', 'progress:100', 'uploaded']);
    expect(FakeXhr.last?.method).toBe('POST');
    expect(FakeXhr.last?.url).toContain('/api/v1/invoices/extract');
    expect(FakeXhr.last?.sentBody).toBeInstanceOf(FormData);
  });

  it('reports an unknown percentage instead of guessing when the size is not computable', async () => {
    const percents: Array<number | null> = [];
    FakeXhr.script = (xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 });
      xhr.respond(200, {});
    };
    vi.stubGlobal('XMLHttpRequest', FakeXhr as any);
    await uploadWithProgress('/x', form(), { onUploadProgress: (p) => percents.push(p.percent) });
    expect(percents).toEqual([null]);
  });

  it('rejects with the server message when processing fails', async () => {
    FakeXhr.script = (xhr) => xhr.respond(503, { detail: 'OCR engine unavailable: worker missing' });
    vi.stubGlobal('XMLHttpRequest', FakeXhr as any);
    const error = await uploadWithProgress('/api/v1/invoices/extract', form()).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.message).toBe('OCR engine unavailable: worker missing');
  });

  it('rejects with a connection error when the upload cannot be sent', async () => {
    FakeXhr.script = (xhr) => xhr.onerror?.({});
    vi.stubGlobal('XMLHttpRequest', FakeXhr as any);
    const error = await uploadWithProgress('/x', form()).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.category).toBe('NETWORK_OR_CORS_FAILURE');
  });
});

describe('invoiceApi.extractInvoice', () => {
  it('uses the progress-reporting upload only when progress callbacks are given', async () => {
    FakeXhr.script = (xhr) => xhr.respond(200, { id: 'via_xhr', items: [] });
    vi.stubGlobal('XMLHttpRequest', FakeXhr as any);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await invoiceApi.extractInvoice(new File(['x'], 'bill.jpg'), { onUploadProgress: () => {} });
    expect(res.id).toBe('via_xhr');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
