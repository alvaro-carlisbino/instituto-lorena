import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fgyfpmnvlkmyxtucbxbu.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc'
const client = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data, error } = await client.from('leads').select('*').is('deleted_at', null)
  console.log('Error:', error)
  console.log('Data length:', data?.length)
}

run()
