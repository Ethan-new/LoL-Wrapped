class AddRecapStatusesToPlayers < ActiveRecord::Migration[7.2]
  def change
    add_column :players, :recap_statuses, :jsonb, default: {}
  end
end
