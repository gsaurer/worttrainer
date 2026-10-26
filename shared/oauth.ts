export type OAuthScope = 'words:read' | 'words:write'

export type ConnectionRequest = {
  clientName: string
  clientOrigin: string
  accountEmail: string
  scopes: OAuthScope[]
}

export type ConnectedAppsState = {
  endpoint: string
  connections: {
    id: string
    clientName: string
    clientOrigin: string
    scopes: OAuthScope[]
    createdAt: string
  }[]
}