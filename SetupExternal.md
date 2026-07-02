## Setup For External Users

1. Git clone repo
```
git clone git@github.com:chanzuckerberg/czid-web.git
cd czid-web
```

2. Create docker containers with:
```
export OFFLINE=1
make local-init
```

This takes around 15 minutes

3. Start the docker containers with:

```
make local-start-webapp
```

The GraphQL API (including the formerly-separate federation resolvers) is served by the
Rails app itself at `/graphql` — no separate service to start.