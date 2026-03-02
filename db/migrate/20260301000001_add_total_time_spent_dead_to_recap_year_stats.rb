# frozen_string_literal: true

class AddTotalTimeSpentDeadToRecapYearStats < ActiveRecord::Migration[8.1]
  def change
    add_column :recap_year_stats, :total_time_spent_dead, :bigint, default: 0, null: false
  end
end
