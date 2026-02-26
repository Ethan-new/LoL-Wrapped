class AddRecapFailureReasonsToPlayers < ActiveRecord::Migration[8.1]
  def change
    add_column :players, :recap_failure_reasons, :jsonb, default: {}
  end
end
