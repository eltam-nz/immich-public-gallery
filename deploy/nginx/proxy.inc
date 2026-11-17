# Using a variable makes nginx re-resolve public-api through Docker's DNS (see
# `resolver` in default.conf), so a recreated public-api with a new IP keeps working.
set $public_api http://public-api:3000;
proxy_pass $public_api;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $client_ip;
proxy_set_header Connection "";
# Never forward credentials or cookies to the API.
proxy_set_header Cookie "";
proxy_set_header Authorization "";
proxy_hide_header X-Powered-By;
proxy_connect_timeout 5s;
proxy_read_timeout 30s;
