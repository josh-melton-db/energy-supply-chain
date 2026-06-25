/**
 * API client for Gulf Coast Operations backend.
 * Uses VITE_BACKEND_URL (e.g. /api in production, http://localhost:8001/api in dev).
 */
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8001/api"

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const response = await fetch(`${BACKEND_URL}/health`)
  if (!response.ok) throw new Error("Backend unavailable")
  return response.json()
}
