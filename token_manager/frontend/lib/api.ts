const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://token-manager-api.twake.local'

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) throw new Error(`API error: ${response.status}`)
  if (response.status === 204) return undefined as T
  return response.json() as T
}
