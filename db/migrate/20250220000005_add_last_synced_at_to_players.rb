# frozen_string_literal: true

class AddLastSyncedAtToPlayers < ActiveRecord::Migration[7.2]
  def change
    add_column :players, :last_synced_at, :datetime
  end
end
