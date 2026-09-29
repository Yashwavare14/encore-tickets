import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/src/services/inventory.service';
import { handleApiError } from '@/src/utils/errors';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ event_id: string }> | { event_id: string } }
) {
  try {
    const params = await Promise.resolve(context.params);
    const event = await InventoryService.getEventWithInventory(params.event_id);
    return NextResponse.json(event, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
