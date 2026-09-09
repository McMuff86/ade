/** Host-local preferences. Absolute paths never enter a mobile DTO. */
export interface ProjectDefaultsInput { rootPath: string; agentId: string | null }
export interface ProjectDefaultsView extends ProjectDefaultsInput { configured: boolean }
export interface ProjectDefaults { rootPath: string; rootIdentity: string; agentId?: string }
