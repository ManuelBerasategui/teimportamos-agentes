# Puente de WhatsApp de SOLO LECTURA para el 805.
# Compila open-bsp-whatsmeow (de Matías Battocchia) en una versión fija y le BORRA
# las rutas que envían mensajes o tocan grupos. Sin esas rutas, el puente no puede
# mandar nada aunque alguien se lo pida.
FROM golang:1.26 AS build
ARG COMMIT=6ae9722ddb21af68b7e8a8471f44d4e6488d3b43
RUN git clone https://github.com/matiasbattocchia/open-bsp-whatsmeow /src && cd /src && git checkout $COMMIT
WORKDIR /src
RUN sed -i -E '/"POST \/dispatch"|"POST \/groups\/|"PATCH \/groups\/|"DELETE \/groups\//d' server.go \
 && ! grep -E '"POST /dispatch"|"POST /groups/|"PATCH /groups/|"DELETE /groups/' server.go \
 && go mod download && CGO_ENABLED=0 go build -o /bridge .

FROM gcr.io/distroless/static-debian12
COPY --from=build /bridge /bridge
EXPOSE 8081
ENTRYPOINT ["/bridge"]
