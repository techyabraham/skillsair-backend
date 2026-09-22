export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'INSUFFICIENT_PERMISSION'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PAYMENT_REQUIRED'
  | 'ACCESS_EXPIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTH_REQUIRED: 401,
  INSUFFICIENT_PERMISSION: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  PAYMENT_REQUIRED: 402,
  ACCESS_EXPIRED: 403,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly fields?: Record<string, string>

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_CODE_STATUS[code]
    this.fields = fields
  }
}

export interface ApiSuccess<T> {
  success: true
  data: T
  meta?: {
    page?: number
    total?: number
    [key: string]: unknown
  }
}

export interface ApiError {
  success: false
  error: {
    code: ErrorCode
    message: string
    fields?: Record<string, string>
  }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export type UserRole = 'admin' | 'instructor' | 'student'

export interface AuthUser {
  id: number
  email: string
  role: UserRole
}

export interface AccessTokenPayload {
  userId: number
  role: UserRole
  type: 'access'
}

export interface RefreshTokenPayload {
  userId: number
  role: UserRole
  type: 'refresh'
  jti: string
}

export type PaymentType = 'course' | 'certificate' | 'subscription'

export interface PaystackInitiateMetadata {
  userId: number
  type: PaymentType
  orderId: number
  courseId?: number
  planId?: number
}

export interface EncryptedPayload {
  iv: string
  authTag: string
  data: string
}
