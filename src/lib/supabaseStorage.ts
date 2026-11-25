export async function uploadReceiptToSupabase(file: File, prefixDate: string): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File bukti nota harus berupa gambar (JPG, PNG, atau WebP).');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Konfigurasi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diatur di environment variables.');
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const fileName = `${prefixDate}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bytes = await file.arrayBuffer();

  const res = await fetch(`${supabaseUrl}/storage/v1/object/notas/${fileName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      'Content-Type': file.type,
      'x-upsert': 'true',
    },
    body: bytes,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal mengunggah foto nota ke Supabase Storage: ${errText}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/notas/${fileName}`;
}