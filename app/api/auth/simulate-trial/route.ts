import { NextRequest, NextResponse } from 'next/server';
import { updateTrialSimulation } from '@/lib/db/firestore';
import { extractBearerToken, verifyToken } from '@/lib/security/jwt';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = extractBearerToken(authHeader);

    let targetEmail = 'optimusdrp@gmail.com';

    if (token) {
      const payload = await verifyToken(token);
      if (payload?.email) {
        targetEmail = payload.email;
      }
    }

    const body = await req.json();
    const mode = body.mode || 'expiring_soon_36h';
    const email = body.email || targetEmail;

    const result = await updateTrialSimulation({
      email,
      mode,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      trialStatus: result.trialStatus,
      message: result.message,
    });
  } catch (error: any) {
    console.error('Erro ao simular estado do Trial:', error);
    return NextResponse.json(
      { error: 'Erro ao processar simulação: ' + (error.message || '') },
      { status: 500 }
    );
  }
}
