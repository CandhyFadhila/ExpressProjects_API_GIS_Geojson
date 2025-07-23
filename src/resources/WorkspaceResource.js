const { resolveArrayRelations } = require("../helpers/resolveArrayRelations");

async function WorkspaceResource(workspace) {
  return {
    id: workspace.id,
    title: workspace.title,
    description: workspace.description,
    thumbnail: await resolveArrayRelations([workspace.thumbnail], "documents"),
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    deleted_at: workspace.deleted_at,
  };
}

module.exports = WorkspaceResource;
