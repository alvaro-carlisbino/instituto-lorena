import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://fgyfpmnvlkmyxtucbxbu.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY' // Wait, I need to get the ANON_KEY

console.log('Testing...');
