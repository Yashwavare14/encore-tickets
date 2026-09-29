import { NextResponse } from 'next/server';
import { HoldsService } from '@/src/services/holds.service';
import { handleApiError } from '@/src/utils/errors';

export async function POST() {
  try {
    const expiredCount = await HoldsService.expireOverdueHolds();
    return NextResponse.json({
      success: true,
      expired_count: expiredCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
