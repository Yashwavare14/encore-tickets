import { NextRequest, NextResponse } from 'next/server';
import { HoldsService } from '@/src/services/holds.service';
import { handleApiError } from '@/src/utils/errors';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ order_id: string }> | { order_id: string } }
) {
  try {
    const params = await Promise.resolve(context.params);
    const result = await HoldsService.cancelOrExpireHold(params.order_id);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
