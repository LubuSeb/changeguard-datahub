import type {
  CatalogSnapshot,
  ChangePassport,
  ChangeProposalDraft,
  HealthResponse,
  PublishReceipt,
} from "../shared/types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`);
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  catalog: () => request<CatalogSnapshot>("/api/catalog"),
  analyze: (proposal: ChangeProposalDraft) => request<ChangePassport>("/api/analyze", {
    method: "POST",
    body: JSON.stringify(proposal),
  }),
  publish: (id: string) => request<PublishReceipt>(`/api/passports/${id}/publish`, { method: "POST" }),
};
