import { createClient } from '@supabase/supabase-js'

const url = "https://fgyfpmnvlkmyxtucbxbu.supabase.co"
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc"

const supabase = createClient(url, key)

async function test() {
  const { data, error } = await supabase.from('pipelines').select('*')
  if (error) {
    console.error("Error connecting:", error)
  } else {
    console.log("Success! Data:", data)
  }
}

test()
