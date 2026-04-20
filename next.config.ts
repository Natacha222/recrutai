import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Permettre l'upload d'offres en PDF (import IA via server action).
      bodySizeLimit: '5mb',
    },
  },
}

export default nextConfig
