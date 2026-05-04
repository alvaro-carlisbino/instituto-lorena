import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Buscar leads que estão em etapas que permitem follow-up (ex: 'novo', 'triagem')
    // e que não tiveram interação humana recente
    const now = new Date();
    
    // Vamos buscar leads que:
    // - Estão com status 'waiting_human' ou 'ai_triaging'
    // - last_interaction_at é antigo o suficiente
    // - Não estão com follow-up 'completed' ou 'interrupted'
    
    const { data: leadsToProcess, error: leadsError } = await supabase
      .from('leads')
      .select(`
        id, 
        patient_name, 
        phone, 
        pipeline_id, 
        last_interaction_at,
        conversation_status,
        crm_lead_followup_state (current_step, last_sent_at, status)
      `)
      .in('conversation_status', ['ai_triaging', 'waiting_human'])
      .not('phone', 'is', null);

    if (leadsError) throw leadsError;

    const results = [];

    for (const lead of (leadsToProcess || [])) {
      const state = lead.crm_lead_followup_state?.[0] || { current_step: 0, status: 'active' };
      
      if (state.status !== 'active') continue;

      const lastInteraction = new Date(lead.last_interaction_at);
      const hoursSinceLastInteraction = (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);

      // Regra de Negócio:
      // Step 1 (D1): > 24h desde a última interação
      // Step 2 (D3): > 72h desde a última interação
      // Step 3 (D5): > 120h desde a última interação

      let targetStep = 0;
      if (hoursSinceLastInteraction >= 120 && state.current_step < 3) targetStep = 3;
      else if (hoursSinceLastInteraction >= 72 && state.current_step < 2) targetStep = 2;
      else if (hoursSinceLastInteraction >= 24 && state.current_step < 1) targetStep = 1;

      if (targetStep > 0) {
        // Buscar o template para este dia
        const { data: config } = await supabase
          .from('crm_followup_configs')
          .select('message_template')
          .eq('pipeline_id', lead.pipeline_id)
          .eq('day_number', targetStep === 1 ? 1 : targetStep === 2 ? 3 : 5)
          .eq('enabled', true)
          .maybeSingle();

        if (config?.message_template) {
          const message = config.message_template.replace('{{name}}', lead.patient_name.split(' ')[0]);
          
          // Chamar o webhook de disparo (simulado aqui, na vida real chamaria o Evolution/Meta)
          // Para esta versão, vamos apenas registrar no histórico e atualizar o estado
          
          await supabase.from('crm_interactions').insert({
            lead_id: lead.id,
            direction: 'out',
            channel: 'whatsapp',
            author: 'Sistema (Follow-up)',
            content: message,
            happened_at: new Date().toISOString()
          });

          // Atualizar o estado do follow-up do lead
          await supabase.from('crm_lead_followup_state').upsert({
            lead_id: lead.id,
            current_step: targetStep,
            last_sent_at: new Date().toISOString(),
            status: targetStep === 3 ? 'completed' : 'active',
            updated_at: new Date().toISOString()
          });

          results.push({ leadId: lead.id, step: targetStep, sent: true });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
