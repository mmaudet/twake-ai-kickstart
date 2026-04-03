import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Token Manager',
  description: 'Twake Token Manager Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen bg-gray-50 text-gray-900">
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col py-6">
          <div className="px-6 mb-8">
            <h1 className="text-lg font-bold text-indigo-600">Token Manager</h1>
          </div>
          <nav className="flex flex-col gap-1 px-3">
            <Link
              href="/admin"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/config"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              Configuration
            </Link>
            <Link
              href="/admin/audit"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              Audit Log
            </Link>
            <div className="my-2 border-t border-gray-200" />
            <Link
              href="/user"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              My Access
            </Link>
          </nav>
        </aside>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </body>
    </html>
  )
}
