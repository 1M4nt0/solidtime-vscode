type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface FetchWrapperConfig {
  baseUrl: string
  apiKey: string
}

export interface RequestOptions<B = unknown> extends Omit<RequestInit, 'method' | 'headers' | 'body'> {
  method?: HttpMethod
  searchParams?: Record<string, string | number | boolean>
  body?: B
  headers?: HeadersInit
}

export class APIError<T = unknown> extends Error {
  constructor(
    public readonly status: number,
    public readonly body: T,
    public readonly request: {url: string; init: RequestInit}
  ) {
    super(`HTTP ${status}`)
  }
}

class FetchWrapper {
  private static instance: FetchWrapper | null = null
  private constructor(private config: FetchWrapperConfig) {}

  static configure(config: FetchWrapperConfig): FetchWrapper {
    if (this.instance) {
      this.instance.config = {...this.instance.config, ...config}
      return this.instance
    }
    this.instance = new FetchWrapper(config)
    return this.instance
  }

  static getInstance(): FetchWrapper {
    if (!this.instance) throw new Error('FetchWrapper has not been configured yet.')
    return this.instance
  }

  async request<R = unknown, B = unknown>(path: string, options: RequestOptions<B> = {}): Promise<R> {
    const {baseUrl, apiKey} = this.config

    const url = new URL(path, baseUrl)
    if (options.searchParams) {
      Object.entries(options.searchParams).forEach(([k, v]) => url.searchParams.append(k, String(v)))
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    }

    let body: BodyInit | undefined = undefined
    const method = options.method ?? 'GET'

    if (method !== 'GET' && options.body !== undefined) {
      if (options.body instanceof FormData || options.body instanceof Blob) {
        body = options.body as BodyInit
      } else {
        body = JSON.stringify(options.body)
        if (!('Content-Type' in headers)) {
          headers['Content-Type'] = 'application/json'
        }
      }
    }

    const init: RequestInit = {...options, method, headers, body}
    const response = await fetch(url.toString(), init)

    const contentType = response.headers.get('content-type') ?? ''
    const isJson = contentType.includes('application/json')
    const parsedBody = isJson ? await response.json() : await response.text()

    if (!response.ok) {
      throw new APIError(response.status, parsedBody, {url: url.toString(), init})
    }

    return parsedBody as R
  }
}

export default FetchWrapper
