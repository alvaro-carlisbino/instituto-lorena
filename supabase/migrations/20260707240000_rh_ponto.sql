-- RH / Ponto eletrônico (pedido do Álvaro 07/jul, formato da Folha de Ponto atual):
--   • Funcionários com quadro de horários semanal (períodos por dia) — base das
--     horas PREVISTAS do espelho.
--   • Batidas de ponto com selfie (evidência), geolocalização e cerca da clínica
--     (distância + dentro/fora); ajuste manual vira "(m)" no espelho.
--   • Folga/feriado/atestado/abono por dia; férias e afastamentos com aprovação.
--   • Formulários de RH (comportamental, personalidade, NR-1 psicossocial) com
--     respostas por funcionário.
-- Papéis: quem gere é admin/gestor (tenant_members) — helper is_tenant_manager.
-- OBS: isto é controle INTERNO de jornada; ponto com validade jurídica plena
-- (REP-P, Portaria 671/2021) exige requisitos formais que ficam fora deste escopo.

create or replace function public.is_tenant_manager(t text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = t
      and tm.auth_user_id = auth.uid()
      and tm.role in ('admin', 'gestor')
  );
$$;
grant execute on function public.is_tenant_manager(text) to authenticated;
grant execute on function public.is_tenant_manager(text) to service_role;

-- 1) Funcionários
create table if not exists public.hr_employees (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default public.current_tenant_id() references public.tenants (id),
  user_id        uuid references auth.users (id),          -- login do funcionário (bate o próprio ponto)
  name           text not null,
  cpf            text,
  role_title     text,                                     -- função (ex.: Técnico de Enfermagem)
  code           text,                                     -- código do colaborador na folha
  admission_date date,
  -- Quadro de horários: {"1":[{"start":"07:00","end":"11:00"},{"start":"11:30","end":"15:30"}], ...}
  -- chave = dia da semana JS (0=domingo … 6=sábado); ausente = não trabalha.
  schedule       jsonb not null default '{}'::jsonb,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists hr_employees_tenant_idx on public.hr_employees (tenant_id, active, name);
create index if not exists hr_employees_user_idx on public.hr_employees (user_id);

-- 2) Configuração da cerca (uma por tenant)
create table if not exists public.hr_settings (
  tenant_id      text primary key default public.current_tenant_id() references public.tenants (id),
  lat            double precision,
  lng            double precision,
  radius_m       integer not null default 150,
  enforce_fence  boolean not null default true,   -- bloqueia batida fora da cerca
  require_selfie boolean not null default true,
  updated_at     timestamptz not null default now()
);

-- 3) Batidas (pareamento entrada/saída é posicional, como na folha)
create table if not exists public.hr_time_entries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default public.current_tenant_id() references public.tenants (id),
  employee_id  uuid not null references public.hr_employees (id) on delete cascade,
  at           timestamptz not null default now(),
  lat          double precision,
  lng          double precision,
  distance_m   integer,
  within_fence boolean,
  selfie_path  text,                                -- bucket crm-lead-attachments
  manual       boolean not null default false,      -- ajuste do gestor → "(m)" no espelho
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists hr_time_entries_emp_idx on public.hr_time_entries (tenant_id, employee_id, at);

-- 4) Marcações do dia (folga/feriado/atestado/abono)
create table if not exists public.hr_day_marks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default public.current_tenant_id() references public.tenants (id),
  employee_id   uuid not null references public.hr_employees (id) on delete cascade,
  day           date not null,
  mark          text not null,                      -- 'folga' | 'feriado' | 'atestado' | 'abono'
  abono_minutes integer not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, employee_id, day)
);

-- 5) Férias e afastamentos
create table if not exists public.hr_leave_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default public.current_tenant_id() references public.tenants (id),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  type        text not null default 'ferias',       -- 'ferias' | 'atestado' | 'folga' | 'outro'
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'pendente',     -- 'pendente' | 'aprovado' | 'negado'
  note        text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists hr_leave_requests_tenant_idx on public.hr_leave_requests (tenant_id, status, start_date);

-- 6) Formulários de RH
create table if not exists public.hr_form_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default public.current_tenant_id() references public.tenants (id),
  name        text not null,
  kind        text not null default 'outro',        -- 'comportamental' | 'personalidade' | 'nr1' | 'outro'
  description text,
  -- [{"id":"q1","text":"...","type":"likert"|"choice"|"text","options":["..."]}]
  questions   jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.hr_form_responses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default public.current_tenant_id() references public.tenants (id),
  template_id  uuid not null references public.hr_form_templates (id) on delete cascade,
  employee_id  uuid not null references public.hr_employees (id) on delete cascade,
  answers      jsonb not null default '{}'::jsonb,  -- {"q1": 4, "q2": "texto"...}
  submitted_at timestamptz not null default now()
);
create index if not exists hr_form_responses_tpl_idx on public.hr_form_responses (tenant_id, template_id, submitted_at desc);

-- 7) RLS
-- Leitura de dados sensíveis (batidas, afastamentos, respostas) = gestor OU o
-- próprio; escrita de gestão = só gestor. Cadastro/config = leitura do tenant.
do $$
declare t text;
begin
  foreach t in array array[
    'hr_employees', 'hr_settings', 'hr_time_entries', 'hr_day_marks',
    'hr_leave_requests', 'hr_form_templates', 'hr_form_responses'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- hr_employees: todo membro do polo vê a equipe; só gestor mexe.
drop policy if exists "hr_employees read" on public.hr_employees;
create policy "hr_employees read" on public.hr_employees for select to authenticated
  using (tenant_id = public.current_tenant_id());
drop policy if exists "hr_employees write" on public.hr_employees;
create policy "hr_employees write" on public.hr_employees for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id))
  with check (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));

-- hr_settings: leitura do tenant (a batida precisa da cerca), escrita do gestor.
drop policy if exists "hr_settings read" on public.hr_settings;
create policy "hr_settings read" on public.hr_settings for select to authenticated
  using (tenant_id = public.current_tenant_id());
drop policy if exists "hr_settings write" on public.hr_settings;
create policy "hr_settings write" on public.hr_settings for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id))
  with check (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));

-- hr_time_entries: vê gestor ou o dono; bate ponto só no PRÓPRIO registro
-- (manual=false); ajuste manual/edição/exclusão só gestor.
drop policy if exists "hr_time_entries read" on public.hr_time_entries;
create policy "hr_time_entries read" on public.hr_time_entries for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_tenant_manager(tenant_id)
      or exists (select 1 from public.hr_employees e where e.id = employee_id and e.user_id = auth.uid())
    )
  );
drop policy if exists "hr_time_entries insert" on public.hr_time_entries;
create policy "hr_time_entries insert" on public.hr_time_entries for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (
      public.is_tenant_manager(tenant_id)
      or (
        manual = false
        and exists (select 1 from public.hr_employees e where e.id = employee_id and e.user_id = auth.uid())
      )
    )
  );
drop policy if exists "hr_time_entries update" on public.hr_time_entries;
create policy "hr_time_entries update" on public.hr_time_entries for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id))
  with check (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));
drop policy if exists "hr_time_entries delete" on public.hr_time_entries;
create policy "hr_time_entries delete" on public.hr_time_entries for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));

-- hr_day_marks: leitura do tenant; escrita do gestor.
drop policy if exists "hr_day_marks read" on public.hr_day_marks;
create policy "hr_day_marks read" on public.hr_day_marks for select to authenticated
  using (tenant_id = public.current_tenant_id());
drop policy if exists "hr_day_marks write" on public.hr_day_marks;
create policy "hr_day_marks write" on public.hr_day_marks for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id))
  with check (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));

-- hr_leave_requests: vê gestor ou o dono; pede o dono; aprova/edita gestor;
-- apaga gestor ou o dono enquanto pendente.
drop policy if exists "hr_leave read" on public.hr_leave_requests;
create policy "hr_leave read" on public.hr_leave_requests for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_tenant_manager(tenant_id)
      or exists (select 1 from public.hr_employees e where e.id = employee_id and e.user_id = auth.uid())
    )
  );
drop policy if exists "hr_leave insert" on public.hr_leave_requests;
create policy "hr_leave insert" on public.hr_leave_requests for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (
      public.is_tenant_manager(tenant_id)
      or exists (select 1 from public.hr_employees e where e.id = employee_id and e.user_id = auth.uid())
    )
  );
drop policy if exists "hr_leave update" on public.hr_leave_requests;
create policy "hr_leave update" on public.hr_leave_requests for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id))
  with check (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));
drop policy if exists "hr_leave delete" on public.hr_leave_requests;
create policy "hr_leave delete" on public.hr_leave_requests for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_tenant_manager(tenant_id)
      or (
        status = 'pendente'
        and exists (select 1 from public.hr_employees e where e.id = employee_id and e.user_id = auth.uid())
      )
    )
  );

-- hr_form_templates: leitura do tenant; escrita do gestor.
drop policy if exists "hr_form_templates read" on public.hr_form_templates;
create policy "hr_form_templates read" on public.hr_form_templates for select to authenticated
  using (tenant_id = public.current_tenant_id());
drop policy if exists "hr_form_templates write" on public.hr_form_templates;
create policy "hr_form_templates write" on public.hr_form_templates for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id))
  with check (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));

-- hr_form_responses: vê gestor ou o dono; responde o dono; apaga gestor.
drop policy if exists "hr_form_responses read" on public.hr_form_responses;
create policy "hr_form_responses read" on public.hr_form_responses for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_tenant_manager(tenant_id)
      or exists (select 1 from public.hr_employees e where e.id = employee_id and e.user_id = auth.uid())
    )
  );
drop policy if exists "hr_form_responses insert" on public.hr_form_responses;
create policy "hr_form_responses insert" on public.hr_form_responses for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and exists (select 1 from public.hr_employees e where e.id = employee_id and e.user_id = auth.uid())
  );
drop policy if exists "hr_form_responses delete" on public.hr_form_responses;
create policy "hr_form_responses delete" on public.hr_form_responses for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_manager(tenant_id));

-- 8) Seeds — config vazia (gestor define a cerca na UI) + 3 formulários padrão.
insert into public.hr_settings (tenant_id) values ('instituto-lorena')
on conflict (tenant_id) do nothing;

insert into public.hr_form_templates (tenant_id, name, kind, description, questions)
select 'instituto-lorena', v.name, v.kind, v.description, v.questions::jsonb
from (values
  (
    'Perfil comportamental (DISC simplificado)',
    'comportamental',
    'Marque a alternativa que MAIS combina com você em cada situação. Não há resposta certa.',
    '[
      {"id":"q1","text":"Diante de um problema novo na clínica, eu costumo…","type":"choice","options":["Decidir rápido e agir","Conversar e engajar as pessoas","Manter a calma e dar estabilidade","Analisar tudo antes de agir"]},
      {"id":"q2","text":"No trabalho em equipe, meu papel natural é…","type":"choice","options":["Puxar a frente e cobrar resultado","Animar e comunicar","Apoiar e manter a harmonia","Organizar e garantir a qualidade"]},
      {"id":"q3","text":"O que mais me incomoda é…","type":"choice","options":["Lentidão para decidir","Ambiente frio e sem interação","Mudança brusca sem aviso","Trabalho malfeito ou sem padrão"]},
      {"id":"q4","text":"Sob pressão, eu tendo a…","type":"choice","options":["Ficar mais direto e impaciente","Falar mais e dispersar","Evitar conflito e me calar","Ficar perfeccionista e crítico"]},
      {"id":"q5","text":"Prefiro tarefas que…","type":"choice","options":["Tenham desafio e autonomia","Envolvam pessoas e comunicação","Sejam estáveis e previsíveis","Exijam precisão e detalhe"]},
      {"id":"q6","text":"Quando recebo uma meta, eu…","type":"choice","options":["Vou atrás do resultado direto","Envolvo o time para chegar junto","Sigo o combinado com constância","Planejo cada etapa antes"]},
      {"id":"q7","text":"Nos conflitos, eu geralmente…","type":"choice","options":["Enfrento de frente","Uso o bom humor para dissolver","Cedo para preservar a relação","Argumento com fatos e dados"]},
      {"id":"q8","text":"Meu ritmo de trabalho é…","type":"choice","options":["Acelerado e focado em entrega","Variável, conforme o entusiasmo","Constante e confiável","Cuidadoso, sem pressa para não errar"]}
    ]'
  ),
  (
    'Autoavaliação de personalidade',
    'personalidade',
    'De 1 (discordo totalmente) a 5 (concordo totalmente), avalie cada afirmação sobre você.',
    '[
      {"id":"q1","text":"Sou organizado(a) e cumpro prazos com facilidade.","type":"likert"},
      {"id":"q2","text":"Me sinto à vontade conversando com pessoas que acabei de conhecer.","type":"likert"},
      {"id":"q3","text":"Costumo manter a calma mesmo em dias difíceis.","type":"likert"},
      {"id":"q4","text":"Gosto de aprender coisas novas e experimentar formas diferentes de trabalhar.","type":"likert"},
      {"id":"q5","text":"Me preocupo genuinamente com o bem-estar dos colegas e pacientes.","type":"likert"},
      {"id":"q6","text":"Prefiro seguir um plano definido a improvisar.","type":"likert"},
      {"id":"q7","text":"Falo o que penso, mesmo quando a opinião é impopular.","type":"likert"},
      {"id":"q8","text":"Fico ansioso(a) quando algo foge do meu controle.","type":"likert"},
      {"id":"q9","text":"Assumo a responsabilidade quando cometo um erro.","type":"likert"},
      {"id":"q10","text":"Consigo me adaptar rápido quando a rotina muda.","type":"likert"}
    ]'
  ),
  (
    'NR-1 — Riscos psicossociais (autoavaliação)',
    'nr1',
    'Levantamento de riscos psicossociais do GRO/PGR (NR-1). De 1 (nunca) a 5 (sempre). Respostas tratadas com confidencialidade.',
    '[
      {"id":"q1","text":"Tenho tempo suficiente para realizar minhas tarefas dentro da jornada.","type":"likert"},
      {"id":"q2","text":"Sei exatamente o que é esperado de mim no trabalho.","type":"likert"},
      {"id":"q3","text":"Tenho autonomia para decidir como executar meu trabalho.","type":"likert"},
      {"id":"q4","text":"Recebo apoio da liderança quando encontro dificuldades.","type":"likert"},
      {"id":"q5","text":"O ambiente entre colegas é de respeito e colaboração.","type":"likert"},
      {"id":"q6","text":"Consigo fazer pausas e me desconectar fora do expediente.","type":"likert"},
      {"id":"q7","text":"Já presenciei ou sofri tratamento humilhante, constrangedor ou assédio no trabalho.","type":"likert"},
      {"id":"q8","text":"A carga emocional do atendimento a pacientes me sobrecarrega.","type":"likert"},
      {"id":"q9","text":"Sinto que meu trabalho é reconhecido.","type":"likert"},
      {"id":"q10","text":"Tenho segurança para relatar problemas sem medo de retaliação.","type":"likert"},
      {"id":"q11","text":"O que poderia melhorar no seu dia a dia de trabalho?","type":"text"}
    ]'
  )
) as v(name, kind, description, questions)
where not exists (
  select 1 from public.hr_form_templates t
  where t.tenant_id = 'instituto-lorena' and t.name = v.name
);
