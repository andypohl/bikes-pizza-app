// Minimal client for the parts of Sanity's HTTP API that publishing needs:
// uploading an image asset, creating and patching documents, and a GROQ
// query. Docs: https://www.sanity.io/docs/http-mutations,
// https://www.sanity.io/docs/http-api-assets, https://www.sanity.io/docs/http-query

export class SanityApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SanityApiError";
    this.status = status;
  }
}

export class SanityClient {
  /**
   * @param {object} options
   * @param {string} options.projectId
   * @param {string} options.dataset
   * @param {string} options.apiVersion   e.g. 2025-02-19
   * @param {string} options.token        a token with write access
   * @param {typeof fetch} [options.fetchImpl]
   */
  constructor({ projectId, dataset, apiVersion, token, fetchImpl = fetch }) {
    if (!projectId || !dataset || !token) throw new Error("Sanity project, dataset and token are required");
    this.base = `https://${projectId}.api.sanity.io/v${apiVersion}`;
    this.dataset = dataset;
    this.token = token;
    this.fetch = fetchImpl;
  }

  async #request(path, { method = "POST", body, contentType = "application/json" } = {}) {
    const response = await this.fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": contentType }) },
      body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      const message = json?.error?.description ?? json?.message ?? json?.error?.message ?? `HTTP ${response.status}`;
      throw new SanityApiError(response.status, `Sanity ${response.status}: ${message}`);
    }
    return json;
  }

  /**
   * Uploads an image and returns the asset document id (`image-...`).
   * @param {{bytes: Buffer|Uint8Array, contentType: string, filename?: string}} image
   */
  async uploadImage({ bytes, contentType, filename }) {
    const query = filename ? `?filename=${encodeURIComponent(filename)}` : "";
    const result = await this.#request(`/assets/images/${this.dataset}${query}`, {
      body: bytes,
      contentType,
    });
    const id = result?.document?._id;
    if (!id) throw new SanityApiError(500, "Sanity did not return an asset id");
    return id;
  }

  /**
   * Runs a GROQ query (against the live API, not the CDN, so writes made a
   * moment ago are seen) and returns its result.
   * @param {string} groq
   * @param {Record<string, unknown>} [params]
   */
  async query(groq, params = {}) {
    const search = new URLSearchParams({ query: groq });
    for (const [key, value] of Object.entries(params)) search.set(`$${key}`, JSON.stringify(value));
    const result = await this.#request(`/data/query/${this.dataset}?${search}`, { method: "GET" });
    return result?.result ?? null;
  }

  /**
   * Sets fields on an existing document.
   * @param {string} id
   * @param {object} set  field → value
   */
  async patchDocument(id, set) {
    await this.#request(`/data/mutate/${this.dataset}`, {
      body: { mutations: [{ patch: { id, set } }] },
    });
  }

  /**
   * Creates a document and returns its id. Pass `draft: true` to create it
   * under the `drafts.` prefix so it shows as a draft in the Studio.
   * @param {object} doc  The document, without `_id` unless you need one
   */
  async createDocument(doc, { draft = false } = {}) {
    const create = draft ? { ...doc, _id: `drafts.${doc._id ?? crypto.randomUUID()}` } : doc;
    const result = await this.#request(`/data/mutate/${this.dataset}?returnIds=true`, {
      body: { mutations: [{ create }] },
    });
    const id = result?.results?.[0]?.id;
    if (!id) throw new SanityApiError(500, "Sanity did not return a document id");
    return id;
  }
}
