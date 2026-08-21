import { NextRequest, NextResponse } from 'next/server';
import { seedFirestoreDatabase, getFirestoreUsers } from '@/lib/db/firestore';
import firebaseConfig from '@/firebase-applet-config.json';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const startTime = Date.now();
    await seedFirestoreDatabase();
    const users = await getFirestoreUsers();

    const sanitizedUsers = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      clinicId: u.clinicId,
      crm: u.crm,
      specialty: u.specialty,
      active: u.active,
      authSource: u.authSource,
    }));

    return NextResponse.json({
      success: true,
      message: 'Banco de dados Firestore semeado com sucesso!',
      totalUsers: sanitizedUsers.length,
      users: sanitizedUsers,
      config: {
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
        collection: 'users',
      },
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[API /api/admin/seed-firestore] Erro ao semear:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Falha ao semear Firestore' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
