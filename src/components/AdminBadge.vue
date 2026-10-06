<template>
  <!-- Marks an admin (PublicUser.is_admin) next to their name, wherever a seat
       is drawn: players see an admin is at the table, and only another admin
       can remove them from it (bridge_backend docs/API.md, Tables). Daylight's
       amber ADMIN tag (#160). -->
  <span class="admin-badge" title="Admin">admin</span>
</template>

<style scoped>
.admin-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--bridge-amber, #f59e0b);
  color: var(--bridge-on-amber, #2b1700);
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
</style>
