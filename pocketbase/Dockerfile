FROM alpine:3.22
ARG PB_VERSION=0.40.4
ARG TARGETARCH
RUN apk add --no-cache ca-certificates unzip wget \
 && case "$TARGETARCH" in amd64|arm64) ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac \
 && mkdir -p /pb /tmp/pb-download \
 && cd /tmp/pb-download \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt" \
 && awk -v file="pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" '$2 == file { print; found=1 } END { if (!found) exit 1 }' checksums.txt > selected.sha256 \
 && sha256sum -c selected.sha256 \
 && unzip -q "pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" pocketbase -d /pb \
 && chmod +x /pb/pocketbase && rm -rf /tmp/pb-download
WORKDIR /pb
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations"]
