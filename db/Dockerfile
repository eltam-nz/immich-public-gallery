FROM postgres:16-alpine
COPY db/migrations /migrations
COPY --chmod=755 db/migrate.sh /usr/local/bin/migrate.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/migrate.sh"]
