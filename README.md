# Twake-Workplace-Docker-Compose




## How it works
The main `docker-compose.yaml` file reference the different parts of the stack using the `include` directive.
It should also host the shared "always-on" part of the stack like the reverse proxy.
Each part of the stack is defined in its own `docker-compose.yml` and `.env` files located in a subfolder.
This allows to easily manage and update each part of the stack independently.

## Cozy-Stack
The Cozy-Stack part was taken directly from the official Cozy-Stack repository:

https://github.com/cozy/cozy-stack-compose

See here for documentation:

https://docs.cozy.io/en/tutorials/selfhosting/docker/

## TODO
- For now I'm leaving the caddy of haproxy but it should be moved the the main docker-compose when other parts of the stack are added.
- It would be nice to be able to use env files using sops to setup ci/cd