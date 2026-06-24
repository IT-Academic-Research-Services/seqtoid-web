module.exports = {
  // ...
  // Configuration options accepted by the `relay-compiler` command-line tool and `babel-plugin-relay`.
  src: "./app/assets/src",
  language: "typescript", // "javascript" | "typescript" | "flow"
  // CZID-305: point Relay at the Rails-native schema (the regenerated IDL with all the
  // ported fed* ops) instead of the federation schema.
  schema: "./graphql_schema/czid_rails_schema.graphql",
  schemaConfig: {
        nodeInterfaceIdField: "_id",
  },
  excludes: ["**/node_modules/**", "**/__mocks__/**", "**/__generated__/**"],
};
