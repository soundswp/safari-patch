create extension if not exists pg_net;

create or replace function public.queue_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_url text := 'https://sdvktobunikpihpchwur.supabase.co/functions/v1/web-welcome-email';
  hook_secret text := '430421228spartan';
begin
  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;

  perform net.http_post(
    url := project_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-welcome-hook-secret', hook_secret
    ),
    body := jsonb_build_object(
      'profile_id', new.id,
      'email', new.email,
      'display_name', coalesce(new.display_name, new.username)
    )
  );

  return new;
end;
$$;

drop trigger if exists profiles_send_welcome_email on public.profiles;

create trigger profiles_send_welcome_email
after insert on public.profiles
for each row
execute function public.queue_welcome_email();
