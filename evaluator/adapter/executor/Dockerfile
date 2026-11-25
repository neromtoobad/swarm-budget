# The public endpoint a Telegraph validator calls to check a newly registered Evaluator adapter.
# It runs the adapter kit's reference executor: the network's own Foundation Model and engine, plus the
# scorer package named by PACKAGE_URL (checked against PACKAGE_SHA256 before it is served).
# It needs about 4.2 GB of memory while loaded, so give it 5 GB or more. It only has to stay up until the
# registration is decided.
FROM golang:1.25 AS build
RUN git clone https://github.com/telegraphprotocol/telegraph-wasm-baseline /src && cd /src && git checkout 1ed063e2f0066cfaf0e124d66ec6a17b7a6121fd
WORKDIR /src
RUN go build -o /adapterexec ./cmd/adapterexec

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG REL=https://github.com/telegraphprotocol/telegraph-foundation/releases/download/modernbert-base-lora16-v1
RUN curl -fsSLO "$REL/foundation_lora_fp32.onnx" && curl -fsSLO "$REL/foundation_engine.wasm" \
 && echo "0a49b325304bb4cf292e683929689d0457966be264f60bfc94d0072b614bf8e6  foundation_lora_fp32.onnx" | sha256sum -c - \
 && echo "77643d6e1176ab8744801cef93ccb844d0136ed32b8daa865d541f37d13292de  foundation_engine.wasm" | sha256sum -c -
COPY --from=build /adapterexec /app/adapterexec
COPY start.sh /app/start.sh
ENV FOUNDATION_MODEL_PATH=/app/foundation_lora_fp32.onnx \
    FOUNDATION_MODEL_HASH=0a49b325304bb4cf292e683929689d0457966be264f60bfc94d0072b614bf8e6 \
    FOUNDATION_ENGINE_WASM_PATH=/app/foundation_engine.wasm \
    FOUNDATION_ENGINE_WASM_HASH=77643d6e1176ab8744801cef93ccb844d0136ed32b8daa865d541f37d13292de
CMD ["sh", "/app/start.sh"]
