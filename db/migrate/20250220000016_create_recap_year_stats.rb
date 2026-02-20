# frozen_string_literal: true

class CreateRecapYearStats < ActiveRecord::Migration[7.2]
  def change
    create_table :recap_year_stats do |t|
      t.references :player, null: false, foreign_key: true
      t.integer :year, null: false
      t.integer :total_pings, default: 0, null: false
      t.jsonb :ping_breakdown, default: {}

      t.timestamps
    end

    add_index :recap_year_stats, %i[player_id year], unique: true
  end
end
