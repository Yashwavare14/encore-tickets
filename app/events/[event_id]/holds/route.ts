import { NextRequest, NextResponse } from 'next/server';
import { CreateHoldSchema } from '@/src/types/api.types';
import { HoldsService } from '@/src/services/holds.service';
import { handleApiError } from '@/src/utils/errors';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ event_id: string }> | { event_id: string } }
) {
  try {
    await Promise.resolve(context.params);
    const body = await request.json();
    const validated = CreateHoldSchema.parse(body);

    const hold = await HoldsService.createHold(validated.tier_id, validated.quantity);
    return NextResponse.json(hold, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
