import { NextRequest, NextResponse } from 'next/server';
import { WebhookPayloadSchema } from '@/src/types/api.types';
import { WebhookService } from '@/src/services/webhook.service';
import { handleApiError } from '@/src/utils/errors';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = WebhookPayloadSchema.parse(body);

    const result = await WebhookService.processWebhook(validated);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
