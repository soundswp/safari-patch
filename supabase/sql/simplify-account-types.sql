update public.profiles
set user_type = case
  when user_type is null or btrim(user_type) = '' then user_type
  when lower(user_type) like '%artist%' and (
    lower(user_type) like '%producer%'
    or lower(user_type) like '%beat producer%'
    or lower(user_type) like '%song producer%'
    or lower(user_type) like '%full stack producer%'
    or lower(user_type) like '%audio engineer%'
    or lower(user_type) like '%dj%'
  ) then 'Artist / Producer'
  when lower(user_type) like '%producer%'
    or lower(user_type) like '%beat producer%'
    or lower(user_type) like '%song producer%'
    or lower(user_type) like '%full stack producer%'
    or lower(user_type) like '%audio engineer%'
    or lower(user_type) like '%dj%' then 'Producer'
  when lower(user_type) like '%artist%'
    or lower(user_type) like '%vocalist%'
    or lower(user_type) like '%singer%'
    or lower(user_type) like '%rapper%' then 'Artist'
  else null
end;
