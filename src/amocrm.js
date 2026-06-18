function createAmoClient(config, fetchImpl = fetch) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  // Пауза между запросами, чтобы не упереться в лимит amoCRM (~7 req/sec). По умолчанию 0.
  const requestDelayMs = Number(config.requestDelayMs) || 0;
  const defaultHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${config.accessToken}`
  };

  async function requestJson(pathOrUrl) {
    const url = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, `${baseUrl}/`);

    const response = await fetchImpl(url, {
      headers: defaultHeaders
    });

    if (!response.ok) {
      const body = typeof response.text === "function" ? await response.text() : "";
      throw new Error(`amoCRM API request failed: ${response.status} ${body}`.trim());
    }

    const payload = await response.json();

    if (requestDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
    }

    return payload;
  }

  async function fetchCollection(firstPath, itemKey) {
    const items = [];
    let nextPath = firstPath;

    while (nextPath) {
      const payload = await requestJson(nextPath);
      const pageItems = payload?._embedded?.[itemKey] || [];
      items.push(...pageItems);
      nextPath = payload?._links?.next?.href || null;
    }

    return items;
  }

  async function fetchAllLeads() {
    return fetchCollection("/api/v4/leads?page=1&limit=250&with=contacts", "leads");
  }

  async function fetchUsers() {
    return fetchCollection("/api/v4/users?page=1&limit=250", "users");
  }

  async function fetchContacts() {
    return fetchCollection("/api/v4/contacts?page=1&limit=250", "contacts");
  }

  async function fetchPipelines() {
    const payload = await requestJson("/api/v4/leads/pipelines");
    return payload?._embedded?.pipelines || [];
  }

  async function fetchLeadById(id) {
    return requestJson(`/api/v4/leads/${id}?with=contacts`);
  }

  async function fetchContactById(id) {
    return requestJson(`/api/v4/contacts/${id}`);
  }

  return {
    fetchAllLeads,
    fetchUsers,
    fetchContacts,
    fetchPipelines,
    fetchLeadById,
    fetchContactById
  };
}

module.exports = {
  createAmoClient
};
