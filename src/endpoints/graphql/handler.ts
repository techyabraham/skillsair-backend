import type { Endpoint, PayloadRequest, SanitizedConfig } from 'payload'
import type { GraphQLSchema } from 'graphql'
import { configToSchema } from '@payloadcms/graphql'
import { createHandler } from 'graphql-http/lib/use/fetch'
import { asyncHandler } from '../../middleware/validate.js'

let cachedSchema: GraphQLSchema | null = null

function getSchema(config: SanitizedConfig): GraphQLSchema {
  if (!cachedSchema) {
    cachedSchema = configToSchema(config).schema
  }
  return cachedSchema
}

async function handler(req: PayloadRequest): Promise<Response> {
  const schema = getSchema(req.payload.config)
  const graphqlHandler = createHandler<{ req: PayloadRequest }>({
    schema,
    context: () => ({ req }),
  })
  return graphqlHandler(req as unknown as Request)
}

export const graphqlPostEndpoint: Endpoint = {
  path: '/graphql',
  method: 'post',
  handler: asyncHandler(handler),
}

export const graphqlGetEndpoint: Endpoint = {
  path: '/graphql',
  method: 'get',
  handler: asyncHandler(handler),
}
