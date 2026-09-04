// Minimal Ghost Admin API client covering what the app needs: look up or
// create a member by email, read and update a member's name and newsletter
// subscriptions, mint a one-time sign-in URL for them, and turn a member's
// submission into a draft post (image upload + post creation).
//
// The sign-in URL endpoint (`members/{id}/signin_urls/`) is what Ghost Admin
// itself uses for "Sign in as member". It is not in the public API docs, so
// if it ever changes this is the file to fix.

import jwt from "jsonwebtoken";

export class GhostApiError extends Error {
  constructor(message, { status, type } = {}) {
    super(message);
    this.name = "GhostApiError";
    this.status = status;
    this.type = type;
  }
}

export class GhostAdminClient {
  /**
   * @param {object} options
   * @param {string} options.url   Ghost site/admin URL, e.g. https://example.ghost.io
   * @param {string} options.key   Admin API key in "id:secret" form
   * @param {typeof fetch} [options.fetch]  Injectable for tests
   */
  constructor({ url, key, fetch: fetchImpl = globalThis.fetch }) {
    const [id, secret] = (key ?? "").split(":");
    if (!id || !secret) {
      throw new Error('Ghost Admin API key must look like "id:secret".');
    }
    if (!url) throw new Error("Ghost Admin API URL is required.");
    this.id = id;
    this.secret = Buffer.from(secret, "hex");
    this.base = `${url.replace(/\/+$/, "")}/ghost/api/admin`;
    this.fetch = fetchImpl;
  }

  /** Short-lived JWT the Admin API expects in the Authorization header. */
  token() {
    return jwt.sign({}, this.secret, {
      keyid: this.id,
      algorithm: "HS256",
      expiresIn: "5m",
      audience: "/admin/",
    });
  }

  async request(method, path, body) {
    return this.send(method, path, {
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Low-level call; `body` is sent as-is (a string or FormData). */
  async send(method, path, { headers = {}, body } = {}) {
    const response = await this.fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Ghost ${this.token()}`,
        "Accept-Version": "v6.0",
        ...headers,
      },
      body,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new GhostApiError(`Ghost returned non-JSON (${response.status}).`, {
        status: response.status,
      });
    }
    if (!response.ok) {
      const first = json.errors?.[0];
      throw new GhostApiError(first?.message ?? `Ghost error ${response.status}`, {
        status: response.status,
        type: first?.type,
      });
    }
    return json;
  }

  /**
   * Returns the member with this ID (including its `newsletters`), or null
   * if it no longer exists.
   */
  async getMember(id) {
    try {
      const json = await this.request("GET", `/members/${encodeURIComponent(id)}/?include=newsletters`);
      return json.members?.[0] ?? null;
    } catch (error) {
      if (error instanceof GhostApiError && error.status === 404) return null;
      throw error;
    }
  }

  /** Returns the member with this email, or null. */
  async findMember(email) {
    const filter = `email:'${email.replace(/'/g, "\\'")}'`;
    const query = new URLSearchParams({ filter, limit: "1", fields: "id,email,name" });
    const json = await this.request("GET", `/members/?${query}`);
    return json.members?.[0] ?? null;
  }

  /**
   * Creates a member. Newsletter subscription is left to Ghost's defaults so
   * app sign-ups behave like sign-ups on the website.
   */
  async createMember({ email, name }) {
    const member = { email };
    if (name) member.name = name;
    const json = await this.request("POST", "/members/?include=newsletters", { members: [member] });
    return json.members[0];
  }

  /**
   * Changes a member's name and/or newsletter subscriptions. `newsletters`
   * is the complete list of newsletter IDs the member should receive; an
   * empty list unsubscribes them from all of them.
   */
  async updateMember(id, { name, newsletters }) {
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (newsletters !== undefined) patch.newsletters = newsletters.map((nid) => ({ id: nid }));
    const json = await this.request(
      "PUT",
      `/members/${encodeURIComponent(id)}/?include=newsletters`,
      { members: [patch] },
    );
    return json.members[0];
  }

  /**
   * Uploads an image to the site's media store and returns its public URL.
   *
   * @param {{bytes: Uint8Array, contentType: string, filename: string}} image
   */
  async uploadImage({ bytes, contentType, filename }) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    form.append("purpose", "image");
    form.append("ref", filename);
    const json = await this.send("POST", "/images/upload/", { body: form });
    const url = json.images?.[0]?.url;
    if (!url) throw new GhostApiError("Ghost did not return an image URL.");
    return url;
  }

  /**
   * Creates a post from HTML (Ghost converts it to its editor format).
   * Returns the post as Ghost stored it (`id`, `status`, `url`, ...).
   */
  async createPost(post) {
    const json = await this.request("POST", "/posts/?source=html", { posts: [post] });
    return json.posts[0];
  }

  /** Active newsletters on the site, in Ghost's sort order. */
  async listNewsletters() {
    const query = new URLSearchParams({ filter: "status:active", limit: "all" });
    const json = await this.request("GET", `/newsletters/?${query}`);
    return json.newsletters ?? [];
  }

  /** @returns {Promise<{id: string, email: string, created: boolean}>} */
  async findOrCreateMember({ email, name }) {
    const existing = await this.findMember(email);
    if (existing) return { ...existing, created: false };
    const created = await this.createMember({ email, name });
    return { ...created, created: true };
  }

  /**
   * One-time URL that signs the member in on the website. `redirectTo`, if
   * given, must be on the same origin as the site and is where Ghost sends
   * the member after the session is established.
   */
  async signInUrl(memberId, { redirectTo } = {}) {
    const json = await this.request("GET", `/members/${memberId}/signin_urls/`);
    const raw = json.member_signin_urls?.[0]?.url;
    if (!raw) throw new GhostApiError("Ghost did not return a sign-in URL.");
    const url = new URL(raw);
    if (redirectTo) {
      const target = new URL(redirectTo, url.origin);
      if (target.origin !== url.origin) {
        throw new GhostApiError("redirectTo must be on the site's own domain.", {
          type: "ValidationError",
        });
      }
      url.searchParams.set("r", target.toString());
    }
    return url.toString();
  }
}
